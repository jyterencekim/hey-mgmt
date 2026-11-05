#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ports = [4321, 4322]
const sleep = (ms) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim()
  } catch (error) {
    if (error.status === 1) return ""
    throw error
  }
}

function commandForPid(pid) {
  return run("ps", ["-p", String(pid), "-o", "command="])
}

function pidsForPort(port) {
  const output = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
  return [...new Set(output.split(/\s+/).filter(Boolean))]
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function isBoardDevProcess(command) {
  return (
    command.includes(appRoot) &&
    command.includes("astro") &&
    /\bdev\b/.test(command)
  )
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!isAlive(pid)) return true
    await sleep(100)
  }
  return !isAlive(pid)
}

const staleProcesses = []

for (const port of ports) {
  for (const pid of pidsForPort(port)) {
    const command = commandForPid(pid)
    if (isBoardDevProcess(command)) {
      staleProcesses.push({ pid, port })
    } else if (command) {
      console.warn(`Leaving non-board process ${pid} on port ${port} alone.`)
    }
  }
}

const uniqueProcesses = [
  ...new Map(staleProcesses.map((item) => [item.pid, item])).values(),
]

if (uniqueProcesses.length === 0) {
  console.log("No stale board dev server found.")
  process.exit(0)
}

let failed = false

for (const { pid, port } of uniqueProcesses) {
  try {
    process.kill(pid, "SIGTERM")
    if (!(await waitForExit(pid, 3000))) {
      process.kill(pid, "SIGKILL")
      await waitForExit(pid, 1000)
    }

    if (isAlive(pid)) {
      failed = true
      console.error(
        `Failed to stop stale board dev server ${pid} on port ${port}.`
      )
    } else {
      console.log(`Stopped stale board dev server ${pid} on port ${port}.`)
    }
  } catch (error) {
    failed = true
    console.error(
      `Failed to stop stale board dev server ${pid} on port ${port}: ${error.message}`
    )
  }
}

if (failed) process.exit(1)
