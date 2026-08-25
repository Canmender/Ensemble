/**
 * Error Boundary
 * Catches React rendering errors and shows a user-friendly fallback UI.
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors , ms } from "../theme";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  private handleReload = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="alert-circle" size={40} color={colors.danger} />
            </View>
            <Text style={styles.title}>应用发生错误</Text>
            <Text style={styles.subtitle}>
              很抱歉，应用遇到了一个意外错误。请尝试重新加载。
            </Text>

            <TouchableOpacity
              style={styles.reloadButton}
              onPress={this.handleReload}
            >
              <Text style={styles.reloadButtonText}>重新加载</Text>
            </TouchableOpacity>

            {this.state.error && (
              <ScrollView style={styles.debugContainer}>
                <Text style={styles.debugTitle}>调试信息</Text>
                <Text style={styles.debugText}>
                  {this.state.error.toString()}
                </Text>
                {this.state.errorInfo && (
                  <Text style={styles.debugText}>
                    {this.state.errorInfo.componentStack}
                  </Text>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = ms({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    width: "100%",
    maxWidth: 400,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(176,80,56,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  reloadButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  reloadButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  debugContainer: {
    maxHeight: 200,
    width: "100%",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 12,
  },
  debugTitle: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
  },
  debugText: {
    color: colors.danger,
    fontSize: 11,
    fontFamily: "monospace",
  },
});
