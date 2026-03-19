#include "BTValidator.h"
#include "BTBuildSpec.h"
#include "BTNodeRegistry.h"
#include "BehaviorTree/BlackboardData.h"
#include "BehaviorTree/Blackboard/BlackboardKeyType_Object.h"
#include "BehaviorTree/Blackboard/BlackboardKeyType_Vector.h"

static FString GetBBKeyTypeName(UBlackboardData* BB, const FString& KeyName)
{
	if (!BB) return FString();

	for (const FBlackboardEntry& Entry : BB->Keys)
	{
		if (Entry.EntryName.ToString() == KeyName && Entry.KeyType)
		{
			// Extract type name from class name: "BlackboardKeyType_Object" -> "Object"
			FString ClassName = Entry.KeyType->GetClass()->GetName();
			FString TypeName;
			if (ClassName.Split(TEXT("BlackboardKeyType_"), nullptr, &TypeName))
			{
				return TypeName;
			}
			return ClassName;
		}
	}
	return FString();
}

static bool BBKeyExists(UBlackboardData* BB, const FString& KeyName)
{
	if (!BB) return false;
	for (const FBlackboardEntry& Entry : BB->Keys)
	{
		if (Entry.EntryName.ToString() == KeyName) return true;
	}
	// Check parent blackboard
	if (BB->Parent)
	{
		return BBKeyExists(BB->Parent, KeyName);
	}
	return false;
}

TArray<FString> FBTValidator::Validate(
	const FBTBuildSpec& Spec,
	const FBTNodeRegistry& Registry,
	UBlackboardData* Blackboard)
{
	TArray<FString> Errors;
	TSet<FString> SeenIds;

	// Rule 1: Root must exist
	if (Spec.Root.Type.IsEmpty())
	{
		Errors.Add(TEXT("[BTValidator] root node has no type"));
		return Errors;
	}

	// Rule 1: Root must be composite
	if (!Registry.IsComposite(Spec.Root.Type))
	{
		Errors.Add(FString::Printf(TEXT("[BTValidator] root type '%s' is not a composite"), *Spec.Root.Type));
	}

	ValidateNode(Spec.Root, Registry, Blackboard, SeenIds, TEXT("root"), Errors);

	return Errors;
}

void FBTValidator::ValidateNode(
	const FBTNodeSpec& Node,
	const FBTNodeRegistry& Registry,
	UBlackboardData* Blackboard,
	TSet<FString>& SeenIds,
	const FString& Path,
	TArray<FString>& OutErrors)
{
	FString NodePath = FString::Printf(TEXT("%s/%s"), *Path, *Node.Id);

	// Rule 7: Unique IDs
	if (Node.Id.IsEmpty())
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] node at %s has empty id"), *Path));
	}
	else if (SeenIds.Contains(Node.Id))
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] duplicate id '%s' at %s"), *Node.Id, *Path));
	}
	else
	{
		SeenIds.Add(Node.Id);
	}

	// Rule 9: Unknown type
	if (!Registry.IsKnownType(Node.Type))
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] unknown type '%s' at %s"), *Node.Type, *NodePath));
		return;  // cannot validate children/params of unknown type
	}

	// Rule 2: Composites must have at least one child
	if (Registry.IsComposite(Node.Type) && Node.Children.Num() == 0)
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] composite '%s' has no children at %s"), *Node.Id, *NodePath));
	}

	// Rule 3: Tasks cannot have children
	if (Registry.IsTask(Node.Type) && Node.Children.Num() > 0)
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] task '%s' has children at %s"), *Node.Id, *NodePath));
	}

	// Rule 4: Only decorator types in decorators array
	for (const FBTNodeSpec& Dec : Node.Decorators)
	{
		if (!Dec.Type.IsEmpty() && Registry.IsKnownType(Dec.Type) && !Registry.IsDecorator(Dec.Type))
		{
			OutErrors.Add(FString::Printf(TEXT("[BTValidator] '%s' in decorators is not a decorator type at %s"), *Dec.Type, *NodePath));
		}
	}

	// Rule 5 & 6: BB key validation
	if (const FString* KeyName = Node.Params.Find(TEXT("blackboard_key")))
	{
		if (Blackboard && !BBKeyExists(Blackboard, *KeyName))
		{
			OutErrors.Add(FString::Printf(TEXT("[BTValidator] blackboard key '%s' not found at %s"), **KeyName, *NodePath));
		}

		// Rule 6: BB key type compatibility
		if (Blackboard)
		{
			const TMap<FString, TSet<FString>>* Reqs = Registry.GetBBKeyRequirements(Node.Type);
			if (Reqs)
			{
				const TSet<FString>* AllowedTypes = Reqs->Find(TEXT("blackboard_key"));
				if (AllowedTypes)
				{
					FString ActualType = GetBBKeyTypeName(Blackboard, *KeyName);
					if (!ActualType.IsEmpty() && !AllowedTypes->Contains(ActualType))
					{
						OutErrors.Add(FString::Printf(
							TEXT("[BTValidator] BB key '%s' is type '%s', but '%s' requires one of: %s at %s"),
							**KeyName, *ActualType, *Node.Type,
							*FString::Join(AllowedTypes->Array(), TEXT(", ")),
							*NodePath
						));
					}
				}
			}
		}
	}

	// Rule 8: condition enum validation for Blackboard decorator
	if (Node.Type == TEXT("Blackboard"))
	{
		if (const FString* Condition = Node.Params.Find(TEXT("condition")))
		{
			if (*Condition != TEXT("IsSet") && *Condition != TEXT("IsNotSet"))
			{
				OutErrors.Add(FString::Printf(
					TEXT("[BTValidator] invalid condition '%s' at %s (must be 'IsSet' or 'IsNotSet')"),
					**Condition, *NodePath
				));
			}
		}
	}

	// Recurse into children
	for (const FBTNodeSpec& Child : Node.Children)
	{
		ValidateNode(Child, Registry, Blackboard, SeenIds, NodePath, OutErrors);
	}

	// Recurse into decorators
	for (const FBTNodeSpec& Dec : Node.Decorators)
	{
		ValidateNode(Dec, Registry, Blackboard, SeenIds, NodePath + TEXT("/decorators"), OutErrors);
	}
}
