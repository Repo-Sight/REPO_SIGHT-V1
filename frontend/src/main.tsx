import { ViteReactSSG } from "vite-react-ssg";
import { routes } from "./routes";
import "./index.css";

// Prerendered to static HTML per route at build time, hydrated on the client.
export const createRoot = ViteReactSSG({ routes });
