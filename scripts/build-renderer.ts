// Compiles native/WebRenderer.swift into bin/jev-web-renderer.
// The pipeline also does this on first run, so this script is optional.
import { buildSidecarBinary } from "../src/render/sidecar";

console.log(buildSidecarBinary());
