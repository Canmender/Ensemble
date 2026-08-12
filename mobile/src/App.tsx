import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { connectionService } from "./services/connection";

// Pages
import DashboardPage from "./pages/DashboardPage";
import TasksPage from "./pages/TasksPage";
import ChatPage from "./pages/ChatPage";
import ContactsPage from "./pages/ContactsPage";
import AgentsPage from "./pages/AgentsPage";
import SettingsPage from "./pages/SettingsPage";
import RunPage from "./pages/RunPage";

// Error boundary
import { ErrorBoundary } from "./components/ErrorBoundary";

// Theme
import { colors } from "./theme";

/** 根导航栈参数表 */
export type RootStackParamList = {
  Main: undefined;
  Run: { runId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

type IconName = keyof typeof Ionicons.glyphMap;

/** Tab 图标（Ionicons，聚焦/非聚焦两种形态） */
const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Dashboard: { active: "grid", inactive: "grid-outline" },
  Tasks: { active: "document-text", inactive: "document-text-outline" },
  Chat: { active: "chatbubble-ellipses", inactive: "chatbubble-ellipses-outline" },
  Contacts: { active: "people", inactive: "people-outline" },
  Agents: { active: "hardware-chip", inactive: "hardware-chip-outline" },
  Settings: { active: "settings", inactive: "settings-outline" },
};

// 底部标签导航
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
        tabBarIcon: ({ color, focused }) => {
          const icon = TAB_ICONS[route.name] ?? TAB_ICONS.Dashboard;
          return <Ionicons name={focused ? icon.active : icon.inactive} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardPage} options={{ title: "看板" }} />
      <Tab.Screen name="Tasks" component={TasksPage} options={{ title: "任务" }} />
      <Tab.Screen name="Chat" component={ChatPage} options={{ title: "聊天" }} />
      <Tab.Screen name="Contacts" component={ContactsPage} options={{ title: "联系人" }} />
      <Tab.Screen name="Agents" component={AgentsPage} options={{ title: "Agent" }} />
      <Tab.Screen name="Settings" component={SettingsPage} options={{ title: "设置" }} />
    </Tab.Navigator>
  );
}

export default function App() {
  // 启动即连接自用云端服务器（账号/会话/IM 全走云端；无需手动选择连接模式）
  useEffect(() => {
    void connectionService.init().then(() => connectionService.connectToCloud());
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <NavigationContainer
          theme={{
            dark: false,
            colors: {
              primary: colors.primary,
              background: colors.bg,
              card: colors.surface,
              text: colors.text,
              border: colors.border,
              notification: colors.primary,
            },
            fonts: {
              regular: { fontFamily: "System", fontWeight: "400" },
              medium: { fontFamily: "System", fontWeight: "500" },
              bold: { fontFamily: "System", fontWeight: "700" },
              heavy: { fontFamily: "System", fontWeight: "900" },
            },
          }}
        >
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="Run"
              component={RunPage}
              options={{
                headerShown: true,
                title: "运行详情",
                headerStyle: { backgroundColor: colors.bg },
                headerTintColor: colors.text,
                headerBackTitle: "返回",
              }}
            />
          </Stack.Navigator>
          <StatusBar style="dark" />
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
