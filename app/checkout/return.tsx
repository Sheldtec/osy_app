import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Where the hosted payment page sends the shopper back to.
 *
 * `Linking.createURL("checkout/return")` resolves to this route, so it catches
 * the cold-start case: if the OS killed the app while the gateway's page was in
 * front, the deep link relaunches it here rather than onto the home screen with
 * a payment nobody ever checks.
 *
 * It holds no state of its own — the reference is the only thing worth carrying
 * and the confirm step is what knows what to do with it. When the link arrives
 * without one, confirm falls back to the pending payment saved before the
 * browser opened.
 */
export default function PaymentReturn() {
  const { tx_ref, tx } = useLocalSearchParams<{ tx_ref?: string; tx?: string }>();
  const ref = tx_ref ?? tx;

  return <Redirect href={ref ? { pathname: "/checkout/confirm", params: { tx: ref } } : "/checkout/confirm"} />;
}
