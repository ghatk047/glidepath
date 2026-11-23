# hud

Flight strip, status chip and toast (UX inventory #3, #18, #27). Presentational: every value arrives as a prop from tier 2 (web binds `res.net`, `res.bar`, `res.gap`, `res.risk`, `br.eps27`); display text comes from `fmt`.

- `<FlightStrip net bar gap risk eps27 hidden variant>`: fixed bottom centre, glass level 2. Net has a progress track that runs to 120% of the bar (`TRACK_SCALE`, a display constant) with a tick at the bar. `hidden` keeps the DOM and hides it (Cockpit). Phone: under 760 px the track, risk and EPS hide with CSS; `variant="phone"` renders net, bar and gap only. Numbers roll (`motion` NumberRoll) and respect reduced motion.
- `<StatusChip gap>` or `<StatusChip status label>`: icon + word + number, never colour alone. `gap >= 0` reads "▲ $23.9M clear", `gap < 0` reads "▼ $23.7M short"; status mode takes `clear | short | conflict | info` and a label such as "1 conflict".
- `<Toast message icon toastId onClose>`: top centre, glass level 3, springs in (`motion.spring`, 300 ms), holds 2.4 s (token `motion.toast`), leaves. The `role="status"` region is always mounted. A new message or `toastId` shows it again.
- CSS is generated from tokens (`styles.ts`) and injected with a React 19 hoisted `<style href precedence>`, so no provider is needed (glass CSS still comes from `GlassProvider`).
