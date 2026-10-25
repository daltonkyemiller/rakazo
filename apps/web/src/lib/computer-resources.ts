export const COMPUTER_RESOURCES_EVENT = "rakazo:open-computer-resources";

export function openComputerResources() {
  window.dispatchEvent(new Event(COMPUTER_RESOURCES_EVENT));
}
