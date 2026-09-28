"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency, formatQuantity } from "@/lib/format";

/**
 * Gráficos do dashboard.
 *
 * Cliente porque o Recharts precisa do DOM. Os dados chegam prontos do
 * servidor — nenhuma agregação acontece aqui (AGENTS.md §5).
 */

const COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];

const AXIS_STYLE = { fontSize: 12 };

function currencyTick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

/** Entradas e saídas por semana. */
export function MovementTrendChart({
  data,
}: {
  data: Array<{ week: string; inbound: number; outbound: number }>;
}) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        Sem movimentação no período.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="inbound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="outbound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
        <XAxis dataKey="week" tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} width={48} />
        <Tooltip
          formatter={(value, name) => [
            formatQuantity(Number(value ?? 0)),
            name === "inbound" ? "Entradas" : "Saídas",
          ]}
        />
        <Legend
          formatter={(value: string) => (value === "inbound" ? "Entradas" : "Saídas")}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="inbound"
          stroke="#16a34a"
          fill="url(#inbound)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="outbound"
          stroke="#0284c7"
          fill="url(#outbound)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Valor de estoque por unidade. */
export function StockValueByBranchChart({
  data,
}: {
  data: Array<{ code: string; name: string; value: number }>;
}) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">Nenhuma unidade ativa.</p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
        <XAxis type="number" tick={AXIS_STYLE} tickFormatter={currencyTick} />
        <YAxis type="category" dataKey="code" tick={AXIS_STYLE} width={72} />
        <Tooltip
          formatter={(value) => formatCurrency(Number(value ?? 0))}
          labelFormatter={(_label, payload) => payload?.[0]?.payload?.name ?? ""}
        />
        <Bar dataKey="value" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Top materiais por consumo. */
export function TopItemsChart({
  data,
}: {
  data: Array<{ name: string; quantity: string; unitCode: string }>;
}) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        Nenhuma saída registrada no período.
      </p>
    );
  }

  const chartData = data.map((row) => ({
    name: row.name.length > 24 ? `${row.name.slice(0, 22)}…` : row.name,
    quantity: Number(row.quantity),
    unitCode: row.unitCode,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
        <XAxis type="number" tick={AXIS_STYLE} />
        <YAxis type="category" dataKey="name" tick={AXIS_STYLE} width={150} />
        <Tooltip
          formatter={(value, _name, payload) => [
            `${formatQuantity(Number(value ?? 0))} ${payload?.payload?.unitCode ?? ""}`,
            "Consumo",
          ]}
        />
        <Bar dataKey="quantity" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Distribuição de valor por categoria. */
export function StockByCategoryChart({
  data,
}: {
  data: Array<{ category: string; value: number }>;
}) {
  const withValue = data.filter((row) => row.value > 0);

  if (withValue.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        Nenhum saldo com valor registrado.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={withValue}
          dataKey="value"
          nameKey="category"
          innerRadius={50}
          outerRadius={90}
          paddingAngle={2}
        >
          {withValue.map((entry, index) => (
            <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
