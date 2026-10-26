import { db } from "./db";
import { publishRefundIssued } from "./events";
import { capturedAmount } from "./payments-client";

export interface Refund {
  id: string;
  paymentId: string;
  amount: number;
}

type Outcome =
  | { kind: "ok"; refund: Refund; replayed: boolean }
  | { kind: "too-much" }
  | { kind: "unknown-payment" };

export async function createRefund(key: string, paymentId: string, amount: number): Promise<Outcome> {
  const earlier = await db.query("select id, payment_id, amount from refunds where idempotency_key = $1", [key]);
  if (earlier.rows.length > 0) return { kind: "ok", refund: toRefund(earlier.rows[0]), replayed: true };
  const captured = await capturedAmount(paymentId);
  if (captured === null) return { kind: "unknown-payment" };
  const refunded = await db.query("select coalesce(sum(amount), 0) as total from refunds where payment_id = $1", [paymentId]);
  if (Number(refunded.rows[0].total) + amount > captured) return { kind: "too-much" };
  const row = await db.query(
    "insert into refunds (idempotency_key, payment_id, amount) values ($1, $2, $3) returning id, payment_id, amount",
    [key, paymentId, amount],
  );
  const refund = toRefund(row.rows[0]);
  await publishRefundIssued(refund);
  return { kind: "ok", refund, replayed: false };
}

export async function getRefund(id: string): Promise<Refund | null> {
  const row = await db.query("select id, payment_id, amount from refunds where id = $1", [id]);
  return row.rows.length === 0 ? null : toRefund(row.rows[0]);
}

function toRefund(row: { id: string; payment_id: string; amount: string }): Refund {
  return { id: row.id, paymentId: row.payment_id, amount: Number(row.amount) };
}
