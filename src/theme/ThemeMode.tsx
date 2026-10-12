import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ThemeProvider } from "styled-components";
import { GlobalStyle } from "./GlobalStyle";
import { themes, type ThemeName } from "./tokens";

const KEY = "veashi-switch-theme";

const ThemeModeContext = createContext<{ name: ThemeName; toggle: () => void }>({ name: "dark", toggle: () => {} });

function initial(): ThemeName {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // storage unavailable: dark first
  }
  return "dark";
}

export const ThemeMode: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [name, setName] = useState<ThemeName>(initial);
  const toggle = useCallback(() => setName((n) => (n === "dark" ? "light" : "dark")), []);
  useEffect(() => {
    document.documentElement.dataset.theme = name;
    document.documentElement.style.colorScheme = name;
    try {
      localStorage.setItem(KEY, name);
    } catch {
      // ignore
    }
  }, [name]);
  const value = useMemo(() => ({ name, toggle }), [name, toggle]);
  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={themes[name]}>
        <GlobalStyle />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => useContext(ThemeModeContext);
