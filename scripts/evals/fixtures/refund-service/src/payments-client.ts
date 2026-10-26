// Asks payment-service how much of a payment was captured, or null for an unknown payment.
export async function capturedAmount(paymentId: string): Promise<number | null> {
  const res = await fetch(`${process.env.PAYMENT_SERVICE_URL}/payments/${encodeURIComponent(paymentId)}`);
  if (res.status === 404) return null;
  const body = (await res.json()) as { captured: number };
  return body.captured;
}
