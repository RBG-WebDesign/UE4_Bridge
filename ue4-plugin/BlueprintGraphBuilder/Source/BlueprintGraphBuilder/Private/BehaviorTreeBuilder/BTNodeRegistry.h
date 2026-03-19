#pragma once

#include "CoreMinimal.h"

class UBTCompositeNode;
class UBTTaskNode;
class UBTDecorator;
class UBTNode;
class UBlackboardData;

class FBTNodeRegistry
{
public:
	FBTNodeRegistry();

	bool IsComposite(const FString& Type) const;
	bool IsTask(const FString& Type) const;
	bool IsDecorator(const FString& Type) const;
	bool IsKnownType(const FString& Type) const;

	TSubclassOf<UBTCompositeNode> GetCompositeClass(const FString& Type) const;
	TSubclassOf<UBTTaskNode> GetTaskClass(const FString& Type) const;
	TSubclassOf<UBTDecorator> GetDecoratorClass(const FString& Type) const;

	const TMap<FString, FString>* GetDefaultParams(const FString& Type) const;
	const TMap<FString, TSet<FString>>* GetBBKeyRequirements(const FString& Type) const;

	/** Apply params to a created node. Handles BlackboardKeySelector resolution. */
	void ApplyParams(
		UBTNode* Node,
		const FString& Type,
		const TMap<FString, FString>& Params,
		UBlackboardData* Blackboard
	) const;

private:
	TMap<FString, TSubclassOf<UBTCompositeNode>> CompositeTypes;
	TMap<FString, TSubclassOf<UBTTaskNode>> TaskTypes;
	TMap<FString, TSubclassOf<UBTDecorator>> DecoratorTypes;

	TMap<FString, TMap<FString, FString>> DefaultParams;
	TMap<FString, TMap<FString, TSet<FString>>> BBKeyTypeRequirements;

	void RegisterTypes();
};
