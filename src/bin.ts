import { main } from "./cli.js";

// A downstream reader (e.g. `| head`) can close its end of the pipe before we're
// done writing. Node then emits an 'error' on stdout instead of throwing, so an
// unhandled listener would crash the process; exit quietly like other Unix tools do.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    process.exitCode = 2;
  },
);
