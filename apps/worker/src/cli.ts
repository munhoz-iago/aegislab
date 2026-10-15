import { runCli } from "./cli-runner.js";

process.exitCode = await runCli(process.env, {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
});
