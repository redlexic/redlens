// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePulseOnChange } from "./usePulseOnChange";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePulseOnChange", () => {
  it("initially returns null", () => {
    const { result } = renderHook(({ v }) => usePulseOnChange(v, 700), {
      initialProps: { v: null as string | null },
    });
    expect(result.current).toBe(null);
  });

  it("changing the input to a non-null value reflects synchronously", () => {
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v, 700), {
      initialProps: { v: null as string | null },
    });
    rerender({ v: "abc" });
    expect(result.current).toBe("abc");
  });

  it("clears back to null after ms elapses", () => {
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v, 700), {
      initialProps: { v: null as string | null },
    });
    rerender({ v: "abc" });
    expect(result.current).toBe("abc");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current).toBe(null);
  });

  it("rapid successive value changes immediately switch to the latest, then clear after ms from the latest", () => {
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v, 700), {
      initialProps: { v: null as string | null },
    });
    rerender({ v: "first" });
    expect(result.current).toBe("first");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender({ v: "second" });
    expect(result.current).toBe("second");
    act(() => {
      vi.advanceTimersByTime(699);
    });
    expect(result.current).toBe("second");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(null);
  });
});
