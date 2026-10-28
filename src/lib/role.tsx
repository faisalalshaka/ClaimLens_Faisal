import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "junior" | "senior";
const Ctx = createContext<{ role: Role; setRole: (r: Role) => void }>({ role: "junior", setRole: () => {} });

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("junior");
  useEffect(() => {
    const r = localStorage.getItem("claimlens-role");
    if (r === "junior" || r === "senior") setRoleState(r);
  }, []);
  const setRole = (r: Role) => {
    setRoleState(r);
    localStorage.setItem("claimlens-role", r);
  };
  return <Ctx.Provider value={{ role, setRole }}>{children}</Ctx.Provider>;
}

export const useRole = () => useContext(Ctx);
