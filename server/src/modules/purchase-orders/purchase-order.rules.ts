import { fromMilli, toMilli } from '../../utils/money.js';

export const PO_STATUSES = ['DRAFT', 'APPROVED', 'READY_TO_SHIP', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** The only status changes the backend will perform. */
export const PO_TRANSITIONS: Record<PoStatus, readonly PoStatus[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransitionPo(from: PoStatus, to: PoStatus): boolean {
  return PO_TRANSITIONS[from].includes(to);
}

export const PO_EDITABLE_STATUSES: readonly PoStatus[] = ['DRAFT'];
export const PO_SHIPPABLE_STATUSES: readonly PoStatus[] = ['READY_TO_SHIP', 'PARTIALLY_RECEIVED'];
export const PO_RECEIVABLE_STATUSES: readonly PoStatus[] = ['READY_TO_SHIP', 'PARTIALLY_RECEIVED'];

export interface ReceivableLine {
  id: string;
  quantity: number;
  receivedQuantity: number;
}

export interface ReceiptLineInput {
  lineId: string;
  quantity: number;
}

export type ReceiptResult =
  | { ok: true; receivedByLine: Record<string, number>; nextStatus: PoStatus }
  | { ok: false; errors: { lineId: string; message: string }[] };

/**
 * Validates a goods receipt against outstanding quantities and computes the
 * resulting per-line received quantities and PO status. Over-receipt is not
 * permitted in this version (see README "Receiving policy").
 */
export function applyReceipt(lines: ReceivableLine[], receipt: ReceiptLineInput[]): ReceiptResult {
  const errors: { lineId: string; message: string }[] = [];
  const seen = new Set<string>();
  const receivedMilli: Record<string, number> = Object.fromEntries(lines.map((l) => [l.id, toMilli(l.receivedQuantity)]));

  if (receipt.length === 0) errors.push({ lineId: '', message: 'Enter a received quantity for at least one line' });

  for (const r of receipt) {
    const line = lines.find((l) => l.id === r.lineId);
    if (!line) {
      errors.push({ lineId: r.lineId, message: 'Line does not belong to this purchase order' });
      continue;
    }
    if (seen.has(r.lineId)) {
      errors.push({ lineId: r.lineId, message: 'Line appears more than once in the receipt' });
      continue;
    }
    seen.add(r.lineId);
    let qtyMilli: number;
    try {
      qtyMilli = toMilli(r.quantity);
    } catch (e) {
      errors.push({ lineId: r.lineId, message: (e as Error).message });
      continue;
    }
    if (qtyMilli <= 0) {
      errors.push({ lineId: r.lineId, message: 'Received quantity must be greater than zero' });
      continue;
    }
    const outstanding = toMilli(line.quantity) - receivedMilli[line.id]!;
    if (qtyMilli > outstanding) {
      errors.push({ lineId: r.lineId, message: `Received quantity exceeds outstanding quantity (${fromMilli(outstanding)})` });
      continue;
    }
    receivedMilli[line.id]! += qtyMilli;
  }

  if (errors.length) return { ok: false, errors };

  const fullyReceived = lines.every((l) => receivedMilli[l.id] === toMilli(l.quantity));
  return {
    ok: true,
    receivedByLine: Object.fromEntries(Object.entries(receivedMilli).map(([k, v]) => [k, fromMilli(v)])),
    nextStatus: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
  };
}
