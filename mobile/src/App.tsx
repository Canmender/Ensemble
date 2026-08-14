import React, { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { connectionService } from "./services/connection";
import { initNotifications } from "./services/notifications";
import { wsLink } from "./services/wslink";
import { api } from "./services/api";
import { useAuthGate } from "./store/authGateStore";
import { useUnreadStore } from "./store/unreadStore";

// Pages
import DashboardPage from "./pages/DashboardPage";
import TasksPage from "./pages/TasksPage";
import ChatPage from "./pages/ChatPage";
import ChatRoomPage from "./pages/ChatRoomPage";
import ContactsPage from "./pages/ContactsPage";
import AgentsPage from "./pages/AgentsPage";
import SettingsPage from "./pages/SettingsPage";
import ProfilePage from "./pages/ProfilePage";
import NotificationSettingsPage from "./pages/NotificationSettingsPage";
import AboutPage from "./pages/AboutPage";
import UserProfilePage from "./pages/UserProfilePage";
import GroupSettingsPage from "./pages/GroupSettingsPage";
import RunPage from "./pages/RunPage";
import LoginPage from "./pages/LoginPage";
import { AppHeader } from "./components/AppHeader";

// Error boundary
import { ErrorBoundary } from "./components/ErrorBoundary";

// Theme
import { colors } from "./theme";

/** 根导航栈参数表 */
export type RootStackParamList = {
  Main: undefined;
  Run: { runId: string };
  ChatRoom: { convId: string; runId?: string; title?: string };
  GroupSettings: { convId: string; title?: string };
  Profile: undefined;
  NotificationSettings: undefined;
  About: undefined;
  UserProfile: { userId: string; name: string; username: string; displayName?: string };
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
  Me: { active: "person", inactive: "person-outline" },
};

/** 底部「聊天」Tab 未读红点角标 */
function ChatTabBadge() {
  const total = useUnreadStore((s) => s.totalUnread);
  if (total <= 0) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: -3,
        right: -6,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: colors.danger,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 4,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>
        {total > 99 ? "99+" : total}
      </Text>
    </View>
  );
}

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
          return (
            <View style={{ width: 26, height: 26 }}>
              <Ionicons name={focused ? icon.active : icon.inactive} size={22} color={color} />
              {route.name === "Chat" && <ChatTabBadge />}
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardPage} options={{ title: "看板", header: () => <AppHeader title="看板" /> }} />
      <Tab.Screen name="Tasks" component={TasksPage} options={{ title: "任务", header: () => <AppHeader title="任务" /> }} />
      <Tab.Screen name="Chat" component={ChatPage} options={{ title: "聊天", header: () => <AppHeader title="聊天" /> }} />
      <Tab.Screen name="Contacts" component={ContactsPage} options={{ title: "联系人", header: () => <AppHeader title="联系人" /> }} />
      <Tab.Screen name="Agents" component={AgentsPage} options={{ title: "Agent", header: () => <AppHeader title="Agent" /> }} />
      <Tab.Screen name="Me" component={SettingsPage} options={{ title: "我", header: () => <AppHeader title="我" /> }} />
    </Tab.Navigator>
  );
}

/** 已登录主界面 */
function MainApp() {
  return (
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
        <Stack.Screen
          name="ChatRoom"
          component={ChatRoomPage}
          options={{
            headerShown: true,
            header: ({ route }) => (
              <AppHeader title={route.params?.title || "聊天"} showBack showAvatar={false} />
            ),
          }}
        />
        <Stack.Screen
          name="GroupSettings"
          component={GroupSettingsPage}
          options={{
            headerShown: true,
            header: ({ route }) => (
              <AppHeader title={route.params?.title || "群设置"} showBack showAvatar={false} />
            ),
          }}
        />
        <Stack.Screen
          name="Profile"
          component={ProfilePage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="个人信息" showBack showAvatar={false} />,
          }}
        />
        <Stack.Screen
          name="NotificationSettings"
          component={NotificationSettingsPage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="通知设置" showBack showAvatar={false} />,
          }}
        />
        <Stack.Screen
          name="About"
          component={AboutPage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="关于" showBack showAvatar={false} />,
          }}
        />
        <Stack.Screen
          name="UserProfile"
          component={UserProfilePage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="个人资料" showBack showAvatar={false} />,
          }}
        />
            headerBackTitle: "返回",
          }}
        />
      </Stack.Navigator>
      <StatusBar style="dark" />
    </NavigationContainer>
  );
}

/** 启动加载屏 */
function LoadingScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <Ionicons name="flash" size={30} color="#fff" />
      </View>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export default function App() {
  const gate = useAuthGate((s) => s.gate);
  const setGate = useAuthGate((s) => s.setGate);

  // 启动：初始化通知 → 连接云端 → 读取登录态 → 进登录页或主界面
  useEffect(() => {
    initNotifications();
    // 异地登录：被踢下线时跳转登录页
    wsLink.on({
      onKicked: () => {
        setGate("out");
        void api.logout();
      },
    });
    (async () => {
      try {
        await connectionService.init();
        await connectionService.connectToCloud();
        const me = await api.getMe();
        setGate(me.data ? "in" : "out");
      } catch {
        setGate("out");
      }
    })();
  }, [setGate]);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        {gate === "loading" && <LoadingScreen />}
        {gate === "out" && <LoginPage />}
        {gate === "in" && <MainApp />}
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
