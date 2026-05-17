export interface Component {
  type: string;
  name: string;
  price: number;
  url?: string;
}

export interface BuildResult {
  components: Component[];
  totalPrice: number;
  explanation: string;
}

export * from "./bot";
