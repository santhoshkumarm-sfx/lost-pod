'use client';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const INK = '#4A5566';

/** Horizontal bars; no entrance animation (the dashboard is a work tool, not a show). */
export function HBarChart({ data, color = '#1F5FBF', colors, height }: {
  data: { name: string; value: number }[]; color?: string; colors?: string[]; height?: number;
}) {
  const h = height ?? Math.max(120, data.length * 26 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke="#E6E8E3" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#F3F4F1' }} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#DCDFD8' }} />
        <Bar dataKey="value" name="Cases" isAnimationActive={false} radius={[0, 2, 2, 0]} barSize={16}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors?.[i] ?? color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

