#!/usr/bin/env node
import { runWriteGuardCli } from "./cli-program.js";

process.exitCode = await runWriteGuardCli(process.argv.slice(2));
