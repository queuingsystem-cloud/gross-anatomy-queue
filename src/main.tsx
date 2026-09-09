import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
import App from "./app/App.tsx";
import AdminApp from "./app/AdminApp.tsx";
import DisplayApp from "./app/DisplayApp.tsx";
import HomeApp from "./app/HomeApp.tsx";
import "./styles/index.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const ROUTE_MAP: Record<string, ComponentType> = {
  "/student": App,
  "/admin": AdminApp,
  "/display": DisplayApp,
};
const RootApp = ROUTE_MAP[path] ?? HomeApp;

createRoot(document.getElementById("root")!).render(<RootApp />);
