/**
 * 可滑动 Tab 容器：用 ScrollView pagingEnabled 实现左右滑动切换 Tab
 * 参考微信/box-im 的滑动切换体验。
 */
import React, { useRef, useEffect, useState } from "react";
import { ScrollView, Dimensions, NativeSyntheticEvent, NativeScrollEvent } from "react-native";

const SCREEN_WIDTH = Dimensions.get("window").width;

interface SwipeableTabsProps {
  tabIndex: number;
  onTabChange: (index: number) => void;
  children: React.ReactNode[];
}

export function SwipeableTabs({ tabIndex, onTabChange, children }: SwipeableTabsProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [isScrolling, setIsScrolling] = useState(false);

  // 外部 Tab 切换时滚动到对应页面
  useEffect(() => {
    if (!isScrolling && scrollRef.current) {
      scrollRef.current.scrollTo({ x: tabIndex * SCREEN_WIDTH, animated: true });
    }
  }, [tabIndex, isScrolling]);

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (newIndex !== tabIndex) {
      onTabChange(newIndex);
    }
    setIsScrolling(false);
  };

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onScrollBeginDrag={() => setIsScrolling(true)}
      onMomentumScrollEnd={onMomentumScrollEnd}
      scrollEventThrottle={16}
    >
      {children.map((child, i) => (
        <React.Fragment key={i}>
          {child}
        </React.Fragment>
      ))}
    </ScrollView>
  );
}
