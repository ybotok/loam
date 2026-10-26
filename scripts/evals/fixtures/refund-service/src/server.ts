import express from "express";
import { createRefund, getRefund } from "./refunds";

const app = express();
app.use(express.json());

// POST /refunds — refund part or all of a captured payment.
// Idempotent on the Idempotency-Key header: a retry returns the first refund.
app.post("/refunds", async (req, res) => {
  const key = req.header("Idempotency-Key");
  if (key === undefined) return res.status(400).json({ error: "Idempotency-Key is required" });
  const result = await createRefund(key, req.body.paymentId, req.body.amount);
  if (result.kind === "too-much") return res.status(422).json({ error: "refund exceeds the captured amount" });
  if (result.kind === "unknown-payment") return res.status(404).json({ error: "no such payment" });
  return res.status(result.replayed ? 200 : 201).json(result.refund);
});

// GET /refunds/:id — read one refund.
app.get("/refunds/:id", async (req, res) => {
  const refund = await getRefund(req.params.id);
  if (refund === null) return res.status(404).end();
  return res.json(refund);
});

app.listen(Number(process.env.PORT ?? 8080));
