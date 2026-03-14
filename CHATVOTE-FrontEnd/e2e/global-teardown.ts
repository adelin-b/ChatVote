import { cleanupPortFile } from "./support/port-utils";

async function globalTeardown() {
  // Stop mock server
  const g = globalThis as Record<string, unknown>;
  const mockServer = g.__MOCK_SERVER__ as
    | { close(): Promise<void> }
    | undefined;
  if (mockServer) {
    await mockServer.close();
    console.info("Mock server stopped");
  }

  // Stop emulators
  const emulatorProcess = g.__EMULATOR_PROCESS__ as
    | { pid?: number }
    | undefined;
  if (emulatorProcess && emulatorProcess.pid) {
    try {
      process.kill(-emulatorProcess.pid, "SIGTERM");
    } catch {
      // process may already be gone
    }
    console.info("Firebase emulators stopped");
  }

  // Clean up the port allocation file
  cleanupPortFile();
}

export default globalTeardown;
