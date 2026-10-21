import { render } from "preact";
import "./styles/tokens.css";
import "./styles/app.css";
import { App } from "./app.tsx";
import { startRouter } from "./lib/router.ts";
import { restoreSession } from "./lib/session.ts";

startRouter();
void restoreSession();
render(<App />, document.getElementById("app")!);
