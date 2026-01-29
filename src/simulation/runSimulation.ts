/**
 * Standalone simulation runner
 * Run this file directly to execute OPD day simulation
 * 
 * Usage: ts-node src/simulation/runSimulation.ts
 */
import { OPDDaySimulation } from './OPDDaySimulation';

async function main() {
  console.log('Starting OPD Day Simulation...\n');

  // Create simulation with custom config
  const simulation = new OPDDaySimulation({
    numberOfDoctors: 3,
    slotsPerDoctor: 4,
    slotCapacity: 30,
    totalPatients: 200,
    emergencyRate: 0.05, // 5% emergency cases
    cancellationRate: 0.1, // 10% cancellations
    noShowRate: 0.08, // 8% no-shows
  });

  try {
    // Run simulation
    const results = await simulation.runSimulation();

    // Additional analysis
    console.log('\n===== ANALYSIS =====');
    console.log(`Total capacity: ${results.totalSlots * 30}`);
    console.log(
      `Utilization rate: ${((results.successfulAllocations / (results.totalSlots * 30)) * 100).toFixed(2)}%`,
    );
    console.log(
      `Emergency allocations: ${results.emergencyAllocations}`,
    );

    const totalEvents = results.cancellations + results.noShows + results.emergencyAllocations;
    console.log(`Total events (cancel/no-show/emergency): ${totalEvents}`);
  } catch (error) {
    console.error('Simulation failed:', error);
    process.exit(1);
  }
}

main();
