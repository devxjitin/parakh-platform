import { useEffect, useRef } from 'react';

/**
 * A step of the exam workflow saves what is on screen when the trainer presses Next. It resolves to
 * `null` when everything is saved (or nothing changed), or to the reason it could not be saved.
 */
export type StepSaver = () => Promise<string | null>;
export type RegisterSave = (fn: StepSaver | null) => void;

/** Lets the page ask this step to save before it moves on. Always calls the latest `save`. */
export function useStepSave(register: RegisterSave | undefined, save: StepSaver) {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    if (!register) return;
    register(() => latest.current());
    return () => register(null);
  }, [register]);
}
