import React, { useEffect, useRef } from "react";
import { View, Text, ActivityIndicator, Image, TouchableOpacity, StyleSheet, Dimensions } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator, BottomTabBar } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { connectionService } from "./services/connection";
import { initNotifications } from "./services/notifications";
import { initGetui } from "./services/getui";
import { checkAndPromptUpdate, bootstrapUpdate } from "./services/appUpdate";
import { UpdateManager } from "./components/UpdateManager";
import { CallModal } from "./components/CallModal";
import { bootstrapCallService, setCallIdentityAndReload } from "./services/callService";
import { wsLink } from "./services/wslink";
import { api } from "./services/api";
import { useAuthGate } from "./store/authGateStore";
import { useUnreadStore } from "./store/unreadStore";
import { useMeStore } from "./store/meStore";

// Pages
import DashboardPage from "./pages/DashboardPage";
import TasksPage from "./pages/TasksPage";
import ChatPage from "./pages/ChatPage";
import ChatRoomPage from "./pages/ChatRoomPage";
import ContactsPage from "./pages/ContactsPage";
import SettingsPage from "./pages/SettingsPage";
import ProfilePage from "./pages/ProfilePage";
import NotificationSettingsPage from "./pages/NotificationSettingsPage";
import AboutPage from "./pages/AboutPage";
import UserProfilePage from "./pages/UserProfilePage";
import GroupSettingsPage from "./pages/GroupSettingsPage";
import PrivacySettingsPage from "./pages/PrivacySettingsPage";
import RunPage from "./pages/RunPage";
import DeviceRemotePage from "./pages/DeviceRemotePage";
import LoginPage from "./pages/LoginPage";
import ChangelogPage from "./pages/ChangelogPage";
import AgentDetailPage from "./pages/AgentDetailPage";
import AssistantPage from "./pages/AssistantPage";
import { AppHeader } from "./components/AppHeader";
import { LiquidGlass } from "./components/Glass";

// Error boundary
import { ErrorBoundary } from "./components/ErrorBoundary";

// Theme
import { colors, radius } from "./theme";

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
  PrivacySettings: undefined;
  DeviceRemote: undefined;
  AgentDetail: { agentId: string };
  Changelog: undefined;
  Assistant: undefined;
  SettingsLLM: undefined;
  SettingsMemory: undefined;
  SettingsMCP: undefined;
  SettingsSkills: undefined;
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

/** 悬浮玻璃 Tab 栏：毛玻璃容器包裹默认 BottomTabBar，浮于内容之上 */
/** 自定义液态玻璃 Tab 栏：每条配色 + 活动项"玻璃胶囊"高亮（人类设计师的细节），避免默认 tab 的"贴纸感" */
/** 悬浮玻璃 Tab 栏：官方 BottomTabBar 包一层液态玻璃 Dock（渲染/交互交给 RN 官方实现，避免自绘 tab 引入崩溃） */
function GlassTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  const DOCK_H = 60;
  const capsuleR = DOCK_H / 2;
  const screenW = Dimensions.get("window").width;
  const dockW = screenW - 32;
  const tabCount = state.routes.length;
  const tabW = dockW / tabCount;

  // 动画共享值
  const pillX = useSharedValue(state.index * tabW);
  const gestureOffset = useSharedValue(0);

  // 同步外部切换
  React.useEffect(() => {
    pillX.value = withSpring(state.index * tabW, { damping: 18, stiffness: 180 });
  }, [state.index]);

  // 拖动切换
  const swipe = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .onUpdate((e) => { gestureOffset.value = e.translationX; })
    .onEnd((e) => {
      gestureOffset.value = 0;
      if (e.translationX < -40 && state.index < tabCount - 1) {
        pillX.value = withSpring((state.index + 1) * tabW, { damping: 18, stiffness: 180 });
        runOnJS(navigation.navigate)(state.routes[state.index + 1].name);
      } else if (e.translationX > 40 && state.index > 0) {
        pillX.value = withSpring((state.index - 1) * tabW, { damping: 18, stiffness: 180 });
        runOnJS(navigation.navigate)(state.routes[state.index - 1].name);
      } else {
        pillX.value = withSpring(state.index * tabW, { damping: 18, stiffness: 180 });
      }
    });

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value + gestureOffset.value * 0.3 }],
  }));

  return (
    <GestureDetector gesture={swipe}>
      <View style={{
        position: "absolute", left: 16, right: 16,
        bottom: Math.max(insets.bottom, 8), height: DOCK_H,
      }} pointerEvents="box-none">
        {/* 毛玻璃胶囊容器 */}
        <View style={{
          flex: 1, borderRadius: capsuleR, overflow: "hidden",
          shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 20,
          shadowOffset: { width: 0, height: 6 }, elevation: 10,
          borderWidth: 0.5,
          borderColor: "rgba(255,255,255,0.3)",
        }}>
          <LiquidGlass blur={50} radiusValue={capsuleR} style={{ flex: 1 }} />
        </View>
        {/* 滑动高亮胶囊 */}
        <Animated.View style={[{
          position: "absolute", top: 5, left: 5,
          width: tabW - 10, height: DOCK_H - 10,
          borderRadius: (DOCK_H - 10) / 2,
          backgroundColor: "rgba(255,255,255,0.25)",
        }, pillStyle]} />
        {/* Tab 按钮 */}
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}>
          {state.routes.map((route: any, index: number) => {
            const focused = state.index === index;
            const icon = TAB_ICONS[route.name] ?? TAB_ICONS.Dashboard;
            const label = route.name === "Me" ? "我" : (descriptors[route.key].options.title ?? route.name);
            return (
              <TouchableOpacity
                key={route.key}
                activeOpacity={0.7}
                onPress={() => {
                  navigation.navigate(route.name);
                  pillX.value = withSpring(index * tabW, { damping: 18, stiffness: 180 });
                }}
                style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons
                  name={focused ? icon.active : icon.inactive}
                  size={22}
                  color={focused ? "#fff" : "rgba(255,255,255,0.55)"}
                />
                <Text style={{
                  fontSize: 10,
                  fontWeight: focused ? "700" : "500",
                  color: focused ? "#fff" : "rgba(255,255,255,0.55)",
                  marginTop: 2,
                  textShadowColor: "rgba(0,0,0,0.3)",
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 2,
                }}>{label}</Text>
                {route.name === "Chat" && <ChatTabBadge />}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </GestureDetector>
  );
}


// 底部标签导航
function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: 2 },
        tabBarItemStyle: { backgroundColor: "transparent" },
        tabBarIconStyle: { marginTop: 2 },
        tabBarIcon: ({ color, focused }) => {
          const icon = TAB_ICONS[route.name] ?? TAB_ICONS.Dashboard;
          return (
            <View style={{ width: 28, height: 26 }}>
              <Ionicons name={focused ? icon.active : icon.inactive} size={23} color={color} />
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
              <AppHeader title={(route.params as { title?: string })?.title || "聊天"} showBack showAvatar={false} />
            ),
          }}
        />
        <Stack.Screen
          name="GroupSettings"
          component={GroupSettingsPage}
          options={{
            headerShown: true,
            header: ({ route }) => (
              <AppHeader title={(route.params as { title?: string })?.title || "群设置"} showBack showAvatar={false} />
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
          name="Changelog"
          component={ChangelogPage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="更新日志" showBack showAvatar={false} />,
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
        <Stack.Screen
          name="PrivacySettings"
          component={PrivacySettingsPage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="隐私设置" showBack showAvatar={false} />,
          }}
        />
        <Stack.Screen
          name="AgentDetail"
          component={AgentDetailPage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="智能体详情" showBack showAvatar={false} />,
          }}
        />
        <Stack.Screen
          name="DeviceRemote"
          component={DeviceRemotePage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="我的电脑" showBack showAvatar={false} />,
          }}
        />
        <Stack.Screen
          name="Assistant"
          component={AssistantPage}
          options={{
            headerShown: true,
            header: () => <AppHeader title="AI 助手" showBack showAvatar={false} />,
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
      <Image source={require("../assets/icon.png")} style={{ width: 72, height: 72, borderRadius: 18, overflow: "hidden", marginBottom: 16 }} resizeMode="contain" />
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}


const styles = StyleSheet.create({
  tabRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", height: 62, paddingTop: 4, paddingBottom: 4 },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabBtn: { alignItems: "center", justifyContent: "center", width: "100%", paddingTop: 4 },
  tabPill: {
    position: "absolute",
    top: 2,
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
  },
  tabIcon: { alignItems: "center", justifyContent: "center", height: 26 },
  tabLabel: { marginTop: 1, fontSize: 10, fontWeight: "600", color: colors.textFaint },
  tabLabelActive: { color: colors.primary, fontWeight: "700" },
});

export default function App() {
  const gate = useAuthGate((s) => s.gate);
  const setGate = useAuthGate((s) => s.setGate);

  // 启动：初始化通知 → 连接云端 → 读取登录态 → 进登录页或主界面
  useEffect(() => {
    initNotifications();
    initGetui();
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
        bootstrapCallService();
        if (me.data) {
          setGate("in");
          setCallIdentityAndReload(me.data.id, me.data.displayName ?? me.data.username);
          void useMeStore.getState().reload();
        } else {
          setGate("out");
        }
      } catch {
        setGate("out");
      }
    })();
  }, [setGate]);

  // 初始化更新下载（前后台保活 + 恢复中断下载现场），再于登录后自动检查更新
  useEffect(() => {
    void bootstrapUpdate();
  }, []);

  // 登录后自动检查应用更新（每次会话一次）；若已有中断下载现场则自动等待重连续传
  const checkedUpdateRef = useRef(false);
  useEffect(() => {
    if (gate === "in" && !checkedUpdateRef.current) {
      checkedUpdateRef.current = true;
      const t = setTimeout(() => {
        void checkAndPromptUpdate();
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [gate]);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        {gate === "loading" && <LoadingScreen />}
        {gate === "out" && <LoginPage />}
        {gate === "in" && <MainApp />}
        <UpdateManager />
        <CallModal />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}