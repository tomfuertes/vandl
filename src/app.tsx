import { createRoot } from "react-dom/client";
import { Wall } from "./components/Wall";
import "./styles.css";

// biome-ignore lint/style/noNonNullAssertion: root element guaranteed by index.html
createRoot(document.getElementById("root")!).render(<Wall />);
