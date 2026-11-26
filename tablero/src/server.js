import express from "express";
import { mountTablero } from "./app.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
await mountTablero(app, process.env);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`linea-color-tablero escuchando en :${PORT}`));
