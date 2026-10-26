import { Kafka } from "kafkajs";
import type { Refund } from "./refunds";

const producer = new Kafka({ brokers: (process.env.KAFKA_BROKERS ?? "").split(",") }).producer();

// Published on the payments topic, beside the payment events other services read.
export async function publishRefundIssued(refund: Refund): Promise<void> {
  await producer.send({
    topic: "payment-events",
    messages: [{ key: refund.paymentId, value: JSON.stringify({ type: "RefundIssued", ...refund }) }],
  });
}
