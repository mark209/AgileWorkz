// Client-supplied reference scope, applied explicitly to a draft.
export const GENERAL_CLEANING_SCOPE = [
  { description: "Review previous checklists or work reports.", method: null, indications: null },
  { description: "Check and record the initial status of the unit.", method: null, indications: null },
  { description: "Shut down unit", method: "Ensure the unit is not energized.", indications: "Electrocution" },
  { description: "Clean the following:\nFace Plate\nAir Filters\n\nInterior / Exterior Panels\nEvaporator / Condenser coil", method: "Wash face plate.\nClean with a vacuum cleaner or pressure washer if the filter is washable.\nUse approved chemical or moist rags.\nPressurized water.", indications: "Dirty and dusty louvers.\nDirty and clogged air filters.\n\nDirty panels.\nDirty coil." },
  { description: "Check Drain Pan", method: "Draining through drain hole (within first three meters only)", indications: "Excessive water at drain pan." },
  { description: "Check the motor and blower for vibration, misalignments & noise.", method: "Inspection of the blower assembly.", indications: "Noise and vibration." },
  { description: "Check and re-tighten all screws and mounting bolts.", method: "Use screwdrivers and wrenches.", indications: "Loose screws and mounting bolts." },
  { description: "Check the electrical side and re-tighten all electrical connections.", method: "Test component for grounding and continuity using calibrated multi-tester.", indications: "Busted fuse / Grounded motor / Signs of burns." },
  { description: "Energize unit.", method: "Ensure that no tools/rags are left inside the unit, and condenser fan guards and panels are installed and secured.", indications: "Electrocution / Physical injury." },
  { description: "Test Equipment", method: "Test operation of components.", indications: "Defective components." },
  { description: "Submit customer equipment maintenance report.", method: null, indications: null },
] as const;
