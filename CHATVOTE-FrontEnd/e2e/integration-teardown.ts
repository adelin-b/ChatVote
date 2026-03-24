async function integrationTeardown() {
  const g = globalThis as Record<string, unknown>;
  const backendProcess = g.__BACKEND_PROCESS__ as { pid?: number } | undefined;
  if (backendProcess?.pid) {
    try {
      process.kill(-backendProcess.pid, "SIGTERM");
    } catch {
      // process may already be gone
    }
    console.info("Backend stopped");
  }

  const emulatorProcess = g.__EMULATOR_PROCESS__ as
    | { pid?: number }
    | undefined;
  if (emulatorProcess?.pid) {
    try {
      process.kill(-emulatorProcess.pid, "SIGTERM");
    } catch {
      // process may already be gone
    }
    console.info("Emulators stopped");
  }
}

export default integrationTeardown;
