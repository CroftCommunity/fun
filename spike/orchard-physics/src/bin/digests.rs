//! Emits the native golden digests as JSON, for `verify.mjs` to cross-check the
//! wasm build against. Separate from `measure` so the cross-check consumes a
//! machine-readable artifact rather than parsing a human report.

use orchard_physics_spike::scenario::{digest, run, TOTAL_TICKS};

fn main() {
    let scenario = digest(&run(TOTAL_TICKS, 0, false));
    let perturbed = digest(&run(TOTAL_TICKS, 1, false));
    let broken = digest(&run(TOTAL_TICKS, 0, true));
    // A few checkpoints, so a wasm divergence can be localised without a bisect.
    let checkpoints: Vec<String> = [1u32, 100, 400, 800, 1200, 2400, 3600]
        .iter()
        .map(|&t| format!("    \"{t}\": \"{:#018x}\"", digest(&run(t, 0, false))))
        .collect();
    println!("{{");
    println!("  \"total_ticks\": {TOTAL_TICKS},");
    println!("  \"scenario\": \"{scenario:#018x}\",");
    println!("  \"perturbed\": \"{perturbed:#018x}\",");
    println!("  \"broken\": \"{broken:#018x}\",");
    println!("  \"checkpoints\": {{");
    println!("{}", checkpoints.join(",\n"));
    println!("  }}");
    println!("}}");
}
