import { CalendarCheck2 } from "lucide-react";

// Add new games here; each entry owns its name, description and destination.
export const learningActivities = [
  {
    id: "daily-task",
    title: "Günlük Görev",
    description: "Yeni kelimeler öğren",
    icon: CalendarCheck2,
    screen: "game" as const,
    badge: "Yeni",
  },
];
