import {
  type AdapterFeatureValue,
  getFeatureCategories,
} from "@/lib/adapter-features";
import { FeatureCell } from "./feature-cell";

interface FeatureSupportProps {
  features?: Record<string, AdapterFeatureValue>;
  type: "platform" | "state";
}

export const FeatureSupport = ({
  features = {},
  type,
}: FeatureSupportProps) => {
  const categories = getFeatureCategories(type);

  return (
    <div className="not-prose mb-6 grid gap-8">
      {categories.map((category) => (
        <section key={category.id}>
          <h3 className="mb-3 font-medium text-base tracking-tight">
            {category.label}
          </h3>
          <div className="overflow-x-auto rounded-sm border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-3/5" />
                <col className="w-2/5" />
              </colgroup>
              <thead className="bg-sidebar text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Feature</th>
                  <th className="px-4 py-2 text-left font-medium">Supported</th>
                </tr>
              </thead>
              <tbody>
                {category.features.map((feature, index) => (
                  <tr
                    className={
                      index === category.features.length - 1 ? "" : "border-b"
                    }
                    key={feature.key}
                  >
                    <td className="px-4 py-2">{feature.label}</td>
                    <td className="px-4 py-2">
                      <FeatureCell value={features[feature.key]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
};
