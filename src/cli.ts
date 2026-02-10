#!/usr/bin/env node
import { startApp } from "./app.ts";

const args = process.argv.slice(2);
const initialFile = args[0];

startApp(initialFile).catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
