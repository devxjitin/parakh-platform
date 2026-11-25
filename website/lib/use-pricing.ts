"use client";

import { useEffect, useState } from "react";
import { API_URL, PRICING, type LivePricing } from "./config";

/** Prices for the page: the fallback first, then whatever the API says today. */
export function usePricing(): LivePricing {
  const [pricing, setPricing] = useState<LivePricing>({ ...PRICING });
  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/catalog/pricing`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then(
        (d: {
          examCreationPaise: number;
          examJoinPaise: number;
          examinerSharePercent: number;
        }) =>
          live &&
          setPricing({
            EXAM_CREATION_PAISE: d.examCreationPaise,
            EXAM_JOIN_PAISE: d.examJoinPaise,
            EXAMINER_SHARE_PERCENT: d.examinerSharePercent,
          }),
      )
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return pricing;
}
