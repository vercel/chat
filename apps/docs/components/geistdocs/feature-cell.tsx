import { Check, Cross, Warn } from "@/components/custom/status-icons";
import {
  type FeatureStatus,
  type FeatureValue,
  normalizeFeatureValue,
} from "@chat-adapter/catalog";

const StatusIcon = ({ status }: { status: FeatureStatus }) => {
  if (status === "yes") {
    return <Check />;
  }
  if (status === "partial") {
    return <Warn />;
  }
  return <Cross />;
};

export const FeatureCell = ({
  value,
}: {
  value: FeatureValue | undefined;
}) => {
  const { status, label } = normalizeFeatureValue(value);
  if (!label) {
    if (status === "partial") {
      return (
        <span className="inline-flex items-center gap-1.5">
          <StatusIcon status={status} />
          Partial
        </span>
      );
    }
    return <StatusIcon status={status} />;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusIcon status={status} />
      {label}
    </span>
  );
};
