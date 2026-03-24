"""Lightweight K8s Job launcher using the in-cluster service account.

Uses only aiohttp (already a dependency) and stdlib — no `kubernetes` package needed.
"""

from __future__ import annotations

import json
import logging
import os
import ssl
import time
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)

_SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount"
_TOKEN_PATH = f"{_SA_DIR}/token"
_CA_PATH = f"{_SA_DIR}/ca.crt"
_NS_PATH = f"{_SA_DIR}/namespace"

_K8S_API = "https://kubernetes.default.svc"

# Labels used to identify admin-launched jobs
_MANAGED_BY_LABEL = "chatvote-admin"
_NODE_ID_LABEL_KEY = "chatvote/node-id"

# Image / resource config (mirrors cronjob-indexer.yaml)
_IMAGE = "rg.fr-par.scw.cloud/chatvote/backend:latest"
_SECRET_NAME = "chatvote-pipeline-env"
_PULL_SECRET = "scaleway-registry"
_NODE_SELECTOR_POOL = "pool-pipeline"


def is_running_in_k8s() -> bool:
    """Return True when we are inside a K8s pod (service account token exists)."""
    return os.path.isfile(_TOKEN_PATH)


def _read_token() -> str:
    with open(_TOKEN_PATH) as f:
        return f.read().strip()


def _read_namespace() -> str:
    with open(_NS_PATH) as f:
        return f.read().strip()


def _make_ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(_CA_PATH)
    return ctx


def _job_name(node_id: str) -> str:
    """Build a unique Job name truncated to 63 characters."""
    ts = int(time.time())
    raw = f"{node_id}-admin-{ts}"
    return raw[:63]


def _job_manifest(
    node_id: str, job_name: str, namespace: str, *, force: bool
) -> dict[str, Any]:
    env: list[dict] = []
    if force:
        env.append({"name": "PIPELINE_FORCE", "value": "true"})

    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "name": job_name,
            "namespace": namespace,
            "labels": {
                "app.kubernetes.io/managed-by": _MANAGED_BY_LABEL,
                _NODE_ID_LABEL_KEY: node_id,
            },
        },
        "spec": {
            "activeDeadlineSeconds": 10800,
            "ttlSecondsAfterFinished": 3600,
            "backoffLimit": 0,
            "template": {
                "metadata": {
                    "labels": {
                        "app.kubernetes.io/managed-by": _MANAGED_BY_LABEL,
                        _NODE_ID_LABEL_KEY: node_id,
                    }
                },
                "spec": {
                    "restartPolicy": "Never",
                    "nodeSelector": {
                        "k8s.scaleway.com/pool-name": _NODE_SELECTOR_POOL,
                    },
                    "imagePullSecrets": [{"name": _PULL_SECRET}],
                    "containers": [
                        {
                            "name": node_id,
                            "image": _IMAGE,
                            "command": ["python", "-m", "src.job_runner", node_id],
                            "env": env,
                            "envFrom": [{"secretRef": {"name": _SECRET_NAME}}],
                            "resources": {
                                "requests": {"memory": "1Gi", "cpu": "500m"},
                                "limits": {"memory": "4Gi", "cpu": "2000m"},
                            },
                        }
                    ],
                },
            },
        },
    }


async def create_pipeline_job(node_id: str, *, force: bool = False) -> dict[str, Any]:
    """Create a K8s Job for the given pipeline node.

    Returns job metadata dict with name, namespace, uid.
    """
    token = _read_token()
    namespace = _read_namespace()
    job_name = _job_name(node_id)
    manifest = _job_manifest(node_id, job_name, namespace, force=force)

    url = f"{_K8S_API}/apis/batch/v1/namespaces/{namespace}/jobs"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    ssl_ctx = _make_ssl_ctx()
    connector = aiohttp.TCPConnector(ssl=ssl_ctx)
    async with aiohttp.ClientSession(connector=connector) as session:
        async with session.post(
            url, headers=headers, data=json.dumps(manifest)
        ) as resp:
            body = await resp.json()
            if resp.status not in (200, 201):
                raise RuntimeError(
                    f"K8s API returned {resp.status} creating job {job_name}: {body}"
                )
            meta = body.get("metadata", {})
            logger.info("[k8s] created job %s for node %s", job_name, node_id)
            return {
                "name": meta.get("name"),
                "namespace": meta.get("namespace"),
                "uid": meta.get("uid"),
            }


async def delete_pipeline_job(node_id: str) -> bool:
    """Delete any running pipeline job for the node.

    Returns True if at least one job was deleted.
    """
    token = _read_token()
    namespace = _read_namespace()

    label_selector = (
        f"app.kubernetes.io/managed-by={_MANAGED_BY_LABEL},"
        f"{_NODE_ID_LABEL_KEY}={node_id}"
    )
    list_url = (
        f"{_K8S_API}/apis/batch/v1/namespaces/{namespace}/jobs"
        f"?labelSelector={label_selector}"
    )
    headers = {"Authorization": f"Bearer {token}"}
    ssl_ctx = _make_ssl_ctx()
    connector = aiohttp.TCPConnector(ssl=ssl_ctx)

    deleted = False
    async with aiohttp.ClientSession(connector=connector) as session:
        async with session.get(list_url, headers=headers) as resp:
            if resp.status != 200:
                logger.warning(
                    "[k8s] failed to list jobs for node %s: %s", node_id, resp.status
                )
                return False
            data = await resp.json()

        for item in data.get("items", []):
            name = item["metadata"]["name"]
            del_url = f"{_K8S_API}/apis/batch/v1/namespaces/{namespace}/jobs/{name}"
            # propagationPolicy=Foreground also deletes dependent pods
            del_params = "?propagationPolicy=Foreground"
            async with session.delete(
                del_url + del_params, headers=headers
            ) as del_resp:
                if del_resp.status in (200, 202):
                    logger.info("[k8s] deleted job %s (node %s)", name, node_id)
                    deleted = True
                else:
                    body = await del_resp.text()
                    logger.warning(
                        "[k8s] failed to delete job %s: %s %s",
                        name,
                        del_resp.status,
                        body,
                    )

    return deleted


async def get_pipeline_job_status(node_id: str) -> dict[str, Any] | None:
    """Return status of the most recent admin pipeline job for a node, or None."""
    token = _read_token()
    namespace = _read_namespace()

    label_selector = (
        f"app.kubernetes.io/managed-by={_MANAGED_BY_LABEL},"
        f"{_NODE_ID_LABEL_KEY}={node_id}"
    )
    list_url = (
        f"{_K8S_API}/apis/batch/v1/namespaces/{namespace}/jobs"
        f"?labelSelector={label_selector}"
    )
    headers = {"Authorization": f"Bearer {token}"}
    ssl_ctx = _make_ssl_ctx()
    connector = aiohttp.TCPConnector(ssl=ssl_ctx)

    async with aiohttp.ClientSession(connector=connector) as session:
        async with session.get(list_url, headers=headers) as resp:
            if resp.status != 200:
                logger.warning(
                    "[k8s] failed to list jobs for node %s: %s", node_id, resp.status
                )
                return None
            data = await resp.json()

    items = data.get("items", [])
    if not items:
        return None

    # Sort by creation timestamp, take the most recent
    items.sort(
        key=lambda x: x.get("metadata", {}).get("creationTimestamp", ""),
        reverse=True,
    )
    job = items[0]
    meta = job.get("metadata", {})
    status = job.get("status", {})

    return {
        "name": meta.get("name"),
        "active": status.get("active", 0),
        "succeeded": status.get("succeeded", 0),
        "failed": status.get("failed", 0),
        "start_time": status.get("startTime"),
    }


async def get_k8s_cluster_status() -> dict[str, Any]:
    """Return overview of K8s resources in the chatvote namespace.

    Returns pods, jobs, cronjobs, and statefulsets with their statuses.
    Falls back to a stub when not running inside K8s.
    """
    if not is_running_in_k8s():
        return {"in_cluster": False}

    token = _read_token()
    namespace = _read_namespace()
    headers = {"Authorization": f"Bearer {token}"}
    ssl_ctx = _make_ssl_ctx()
    connector = aiohttp.TCPConnector(ssl=ssl_ctx)

    result: dict[str, Any] = {"in_cluster": True, "namespace": namespace}

    async with aiohttp.ClientSession(connector=connector) as session:
        # --- Pods ---
        try:
            url = f"{_K8S_API}/api/v1/namespaces/{namespace}/pods"
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    pods = []
                    for item in data.get("items", []):
                        meta = item.get("metadata", {})
                        status = item.get("status", {})
                        container_statuses = status.get("containerStatuses", [])
                        ready = (
                            all(cs.get("ready", False) for cs in container_statuses)
                            if container_statuses
                            else False
                        )
                        restarts = sum(
                            cs.get("restartCount", 0) for cs in container_statuses
                        )
                        pods.append(
                            {
                                "name": meta.get("name"),
                                "phase": status.get("phase"),
                                "ready": ready,
                                "restarts": restarts,
                                "node": item.get("spec", {}).get("nodeName", ""),
                                "started_at": status.get("startTime"),
                            }
                        )
                    result["pods"] = pods
        except Exception as exc:
            logger.warning("[k8s] failed to list pods: %s", exc)
            result["pods"] = []

        # --- Jobs ---
        try:
            url = f"{_K8S_API}/apis/batch/v1/namespaces/{namespace}/jobs"
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    jobs = []
                    for item in data.get("items", []):
                        meta = item.get("metadata", {})
                        st = item.get("status", {})
                        jobs.append(
                            {
                                "name": meta.get("name"),
                                "active": st.get("active", 0),
                                "succeeded": st.get("succeeded", 0),
                                "failed": st.get("failed", 0),
                                "start_time": st.get("startTime"),
                                "completion_time": st.get("completionTime"),
                            }
                        )
                    result["jobs"] = jobs
        except Exception as exc:
            logger.warning("[k8s] failed to list jobs: %s", exc)
            result["jobs"] = []

        # --- CronJobs ---
        try:
            url = f"{_K8S_API}/apis/batch/v1/namespaces/{namespace}/cronjobs"
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    cronjobs = []
                    for item in data.get("items", []):
                        meta = item.get("metadata", {})
                        spec = item.get("spec", {})
                        st = item.get("status", {})
                        cronjobs.append(
                            {
                                "name": meta.get("name"),
                                "schedule": spec.get("schedule"),
                                "suspend": spec.get("suspend", False),
                                "last_schedule": st.get("lastScheduleTime"),
                                "active_jobs": len(st.get("active", [])),
                            }
                        )
                    result["cronjobs"] = cronjobs
        except Exception as exc:
            logger.warning("[k8s] failed to list cronjobs: %s", exc)
            result["cronjobs"] = []

        # --- StatefulSets ---
        try:
            url = f"{_K8S_API}/apps/v1/namespaces/{namespace}/statefulsets"
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    sts = []
                    for item in data.get("items", []):
                        meta = item.get("metadata", {})
                        st = item.get("status", {})
                        sts.append(
                            {
                                "name": meta.get("name"),
                                "ready": st.get("readyReplicas", 0),
                                "replicas": st.get("replicas", 0),
                            }
                        )
                    result["statefulsets"] = sts
        except Exception as exc:
            logger.warning("[k8s] failed to list statefulsets: %s", exc)
            result["statefulsets"] = []

    return result
