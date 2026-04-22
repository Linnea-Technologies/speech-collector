import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "bootstrap/dist/css/bootstrap.css";
import "./index.css";
import { SessionProvider } from "../contexts/SessionProvider.tsx";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <SessionProvider>
    <App />
  </SessionProvider>
);
