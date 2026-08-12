import { readConfig } from "./config.mjs";
import { getAdapter, listAdapters } from "./adapters/index.mjs";

export async function generateArtifacts(cwd, harness, componentsDir) {
  const config = readConfig(cwd);
  if (!config) {
    console.log("No nstack config found. Run 'nstack init' first.");
    return;
  }

  const projectHome = config.projectHome || false;

  if (harness) {
    const adapter = getAdapter(harness);
    if (!adapter) {
      console.error(`Unknown harness: ${harness}`);
      console.error(`Supported: ${listAdapters().join(", ")}`);
      process.exit(1);
    }
    if (!config.tools?.[harness]) {
      console.log(`Tool '${harness}' not initialized. Run 'nstack init ${harness}' first.`);
      return;
    }
    await adapter.generate(cwd, componentsDir, projectHome);
  } else {
    const tools = Object.keys(config.tools || {});
    if (tools.length === 0) {
      console.log("No tools initialized. Run 'nstack init <tool>' first.");
      return;
    }
    for (const tool of tools) {
      const adapter = getAdapter(tool);
      if (adapter) {
        console.log(`\n--- ${tool} ---`);
        await adapter.generate(cwd, componentsDir, projectHome);
      }
    }
  }
}
