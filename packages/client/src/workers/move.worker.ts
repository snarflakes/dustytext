import { encodeFunctionData } from 'viem';

const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';

// Correct ABI matching MoveSystem.sol
const MOVE_ABI = [
  {
    name: 'app__move',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'direction',
        type: 'uint8', // Direction enum
      },
    ],
    outputs: [],
  },
];

type Direction = 'north' | 'south' | 'east' | 'west';

// Convert direction string to enum value
function directionToEnum(direction: Direction): number {
  switch (direction) {
    case 'north': return 0;
    case 'east': return 1;
    case 'south': return 2;
    case 'west': return 3;
    default: return 0;
  }
}

async function move(direction: Direction) {
  const directionEnum = directionToEnum(direction);

  const data = encodeFunctionData({
    abi: MOVE_ABI,
    functionName: 'app__move',
    args: [directionEnum],
  });

  console.log('[MOVE]', { direction, directionEnum });

  try {
    postMessage({ type: 'log', message: `Attempting to move ${direction}...` });
    
    // Send transaction data back to main thread for execution
    postMessage({ 
      type: 'transaction', 
      params: {
        to: WORLD_ADDRESS,
        data,
        gas: 100000n,
      }
    });
    
  } catch (error) {
    postMessage({ 
      type: 'done', 
      message: `Move ${direction} failed: ${(error as Error).message}`, 
      status: 'error' 
    });
  }
}

self.onmessage = (event) => {
  if (event.data?.type === 'init' && event.data.direction) {
    const direction = event.data.direction as Direction;
    move(direction);
  } else if (event.data?.type === 'transaction-success') {
    postMessage({ type: 'done', message: `Move completed ✅`, status: 'success' });
  } else if (event.data?.type === 'transaction-error') {
    postMessage({ 
      type: 'done', 
      message: `Move failed: ${event.data.error}`, 
      status: 'error' 
    });
  }
};
