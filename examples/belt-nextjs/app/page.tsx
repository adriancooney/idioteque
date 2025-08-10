import { createOrder } from "../lib/orders";

async function placeOrder() {
  "use server";

  await createOrder();
}

export default function Home() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Belt Event Demo</h1>
      <p>Click to place an order and see async processing in action:</p>

      <div
        style={{
          marginBottom: "1rem",
          padding: "1rem",
          backgroundColor: "#f5f5f5",
          borderRadius: "6px",
        }}
      >
        <h3>What happens:</h3>
        <ul>
          <li>💳 Process payment</li>
          <li>📧 Send confirmation</li>
          <li>📦 Update inventory</li>
        </ul>
      </div>

      <form action={placeOrder}>
        <button
          type="submit"
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            backgroundColor: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Place Order
        </button>
      </form>
    </div>
  );
}
