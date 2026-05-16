
import { ProviderRegistry } from '../llm/ProviderRegistry.ts';

export class SimulationManager {
    private static isSimMode = false;

    public static enable() {
        this.isSimMode = true;
        console.log("🛠️  SIMULATION MODE ENABLED: Orchestra will now use its Recursive Logic Engine to simulate high-fidelity agent interactions.");
    }

    public static disable() {
        this.isSimMode = false;
    }

    public static isActive() {
        return this.isSimMode;
    }
}
