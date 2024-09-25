// Write a function that returns either 'heads' or 'tails' when called.
// The return value should be random.

export function flipCoin(): 'heads' | 'tails' {
    return Math.random() > 0.5 ? 'heads' : 'tails';
}
