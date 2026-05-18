import { Route, Switch } from "wouter";
import { AdminPage } from "./AdminPage";
import { PalettePage } from "./PalettePage";

export function AdminEntry() {
  return (
    <Switch>
      <Route path="/admin/palette">
        <PalettePage />
      </Route>
      <Route path="/admin">
        <AdminPage />
      </Route>
      <Route>
        <div style={{ padding: 32, color: "var(--tan-3)" }} className="mono">
          admin: not found
        </div>
      </Route>
    </Switch>
  );
}
