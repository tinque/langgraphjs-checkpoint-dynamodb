import { describe, it, expect } from 'bun:test';

import { flipCoin } from '../flipCoin';

describe('flipCoin', () => {
    it('should return either heads or tails', () => {
        const result = flipCoin();
        expect(result).toMatch(/heads|tails/);
    });
});
