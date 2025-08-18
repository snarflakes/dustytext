import { CommandHandler, CommandContext } from './types';

export class DoneCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    // Import the selected blocks from explore command
    const { selectedBlocks, clearSelection } = await import('./explore');
    
    if (selectedBlocks.length === 0) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❓ No blocks selected for mining. Use 'explore' first and click on blocks." 
      }));
      return;
    }

    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `⛏️ Starting to mine ${selectedBlocks.length} selected blocks...` 
    }));

    // Import mine command
    const { getCommand } = await import('./registry');
    const mineCommand = getCommand('mine');
    
    if (!mineCommand) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Mine command not available" 
      }));
      return;
    }

    // Mine each selected block
    for (let i = 0; i < selectedBlocks.length; i++) {
      const block = selectedBlocks[i];
      
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `⛏️ Mining ${block.name} at (${block.x}, ${block.y}, ${block.z}) [${i + 1}/${selectedBlocks.length}]` 
      }));
      
      // Pass coordinates as JSON string to work with CommandHandler interface
      const coordsJson = JSON.stringify({ x: block.x, y: block.y, z: block.z });
      await mineCommand.execute(context, coordsJson);
      
      // Small delay between mining operations
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    clearSelection();
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `✅ Completed mining ${selectedBlocks.length} blocks!` 
    }));
  }
}

