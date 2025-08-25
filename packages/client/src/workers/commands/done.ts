import { CommandHandler, CommandContext } from './types';

export class DoneCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    // Import the selected blocks from explore command
    const { selectedBlocks: miningBlocks, clearSelection: clearMiningSelection } = await import('./explore');
    
    // Import the selected blocks from water command
    const { selectedBlocks: wateringBlocks, clearSelection: clearWaterSelection, waterSingleBlock } = await import('./water');
    
    if (miningBlocks.length > 0) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `⛏️ Starting to mine ${miningBlocks.length} selected blocks...` 
      }));
      
      // Mine each selected block
      let successCount = 0;
      for (const block of miningBlocks) {
        try {
          const { getCommand } = await import('./registry');
          const mineCommand = getCommand('mine');
          if (mineCommand) {
            await mineCommand.execute(context, JSON.stringify(block));
            successCount++;
          }
        } catch (error) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ Failed to mine block at (${block.x}, ${block.y}, ${block.z}): ${error}` 
          }));
        }
        
        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `⛏️ Mining complete! Successfully mined ${successCount}/${miningBlocks.length} blocks.` 
      }));

      clearMiningSelection();
    } else if (wateringBlocks.length > 0) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `💧 Starting to water ${wateringBlocks.length} selected farmland blocks...` 
      }));

      let successCount = 0;
      for (const block of wateringBlocks) {
        const success = await waterSingleBlock(context, block);
        if (success) successCount++;
        
        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `💧 Watering complete! Successfully watered ${successCount}/${wateringBlocks.length} blocks.` 
      }));

      clearWaterSelection();
    } else {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❓ No blocks selected for mining or watering. Use 'explore' or 'water' first and click on blocks." 
      }));
    }
  }
}




