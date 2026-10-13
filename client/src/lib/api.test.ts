import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage } from './api';

describe('errorMessage', () => {
  it('adds the first field problem to validation errors', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Request validation failed', [{ path: 'destination.city', message: 'Origin and destination must differ' }]);
    expect(errorMessage(err)).toBe('Request validation failed: Origin and destination must differ');
  });

  it('uses the server message for other errors', () => {
    expect(errorMessage(new ApiError(409, 'CONFLICT', 'This shipment is already booked'))).toBe('This shipment is already booked');
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});
