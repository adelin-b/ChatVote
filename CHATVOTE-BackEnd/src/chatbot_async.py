# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import logging
from typing import List, Union

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.documents import Document

from src.llms import (
    DETERMINISTIC_LLMS,
    get_answer_from_llms,
    get_structured_output_from_llms,
)
from src.models.assistant import Assistant
from src.models.party import Party
from src.prompts import (
    reranking_system_prompt_template,
    reranking_user_prompt_template,
    system_prompt_improvement_rag_template_vote_behavior_summary,
    user_prompt_improvement_rag_template_vote_behavior_summary,
)
from src.models.structured_outputs import RerankingOutput
from src.utils import build_document_string_for_context, load_env

load_env()

logger = logging.getLogger(__name__)

# Type for entities that can respond to questions (party or assistant)
Responder = Union[Party, Assistant]

reranking_llms = DETERMINISTIC_LLMS
prompt_improvement_llms = DETERMINISTIC_LLMS


async def rerank_documents(
    relevant_docs: List[Document],
    user_message: str,
    chat_history: str,
    top_k: int = 5,
) -> List[Document]:
    # get the context and the relevant documents
    docs = [
        build_document_string_for_context(index, doc, doc_num_label="Index")
        for index, doc in enumerate(relevant_docs)
    ]
    sources_str = "\n".join(docs)
    # build messages for the reranking model
    system_prompt = reranking_system_prompt_template.format(sources=sources_str)
    user_prompt = reranking_user_prompt_template.format(
        conversation_history=chat_history, user_message=user_message
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    # rerank the documents
    response = await get_structured_output_from_llms(
        reranking_llms, messages, RerankingOutput
    )

    # get the reranked document indices
    reranked_doc_indices = getattr(response, "reranked_doc_indices", [])
    logger.debug(f"Reranked document indices: {reranked_doc_indices}")
    try:
        relevant_indices = reranked_doc_indices[:top_k]
        reranked_relevant_docs = [relevant_docs[i] for i in relevant_indices]
        logger.debug(f"Reranked document indices (top_k={top_k}): {relevant_indices}")
        return reranked_relevant_docs
    except Exception as e:
        logger.error(f"Error extracting reranked documents: {e}")
        logger.warning(f"Returning top-{top_k} of original relevant documents.")
        return relevant_docs[:top_k]


async def get_improved_rag_query_voting_behavior(
    party: Party, last_user_message: str, last_assistant_message: str
) -> str:
    system_prompt = system_prompt_improvement_rag_template_vote_behavior_summary.format(
        party_name=party.name
    )
    user_prompt = user_prompt_improvement_rag_template_vote_behavior_summary.format(
        last_user_message=last_user_message,
        last_assistant_message=last_assistant_message,
        party_name=party.name,
    )

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    response = await get_answer_from_llms(prompt_improvement_llms, messages)

    return getattr(response, "content", "")
